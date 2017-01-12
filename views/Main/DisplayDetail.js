/* @flow */
import Promise from 'bluebird';
import { words, takeRight } from 'lodash';

import React, { Component, PropTypes } from 'react';
import { autobind } from 'core-decorators';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

import BleManager from 'react-native-ble-manager';
import Snackbar from 'react-native-android-snackbar';

import { TouchableOpacity, View, Dimensions, BackAndroid, StyleSheet, NativeAppEventEmitter } from 'react-native';
import { Container, Header, Title, InputGroup, List, ListItem, Text, Input, Icon, Content, Footer, FooterTab, Button } from 'native-base';
import { Col, Row, Grid } from 'react-native-easy-grid';

import { LineChart } from 'react-native-mp-android-chart';

import { disconnectCurrentPeripheral } from '../../data/reducers/peripheral';

const colorSwatches = ['#F44336', '#9C27B0'];
const { width: windowWidth, height: windowHeight } = Dimensions.get('window');
const styles = StyleSheet.create({
  chart: {
    height: (windowHeight - 200) / 3,
    width: windowWidth
  }
});

function parseRadix16(hexNumber) {
  // const 量程 = 16384;
  const 量程 = 17039;
  return new Buffer.from(hexNumber, 'hex').readInt16LE(0) / 量程;
}

function mapStateToProps(state) {
  const data = state.peripheral.getIn(['data']);
  return {
    peripheralInfo: data,
    name: data.name,
    id: data.id,
    characteristics: data.characteristics,
  };
}

function mapDispatchToProps(dispatch) {
  return bindActionCreators({ disconnectCurrentPeripheral }, dispatch);
}


@connect(mapStateToProps, mapDispatchToProps)
@autobind
export default class PeripheralDetail extends Component {
  static contextTypes = { router: PropTypes.object };
  static propTypes = {
    disconnectCurrentPeripheral: PropTypes.func.isRequired,
  };

  state = {
    errorInfo: '',
    showDetail: false,
    notifying: false,
    openLineChart: true,
    eventListener: null,
    accCurrentData: '                      ',
    gyoCurrentData: '                      ',
    accDataCache: [
      { name: '加速度X·G¹', values: [] },
      { name: '加速度Y·G¹', values: [] },
      { name: '加速度Z·G¹', values: [] }
    ],
    gyoDataCache: [
      { name: '陀螺仪X·G¹', values: [] },
      { name: '陀螺仪Y·G¹', values: [] },
      { name: '陀螺仪Z·G¹', values: [] }
    ],
    dataCacheLimit: 10,
    lastACCDataUpdateTime: new Date().getTime(),
    lastGYODataUpdateTime: new Date().getTime(),
    updatePeriod: 1500, // ms
  }

  componentDidMount() {
    BackAndroid.addEventListener('hardwareBackPress', this.handleBack);
  }

  handleBack() {
    this.context.router.transitionTo('/');
    this.props.disconnectCurrentPeripheral();
    return true;
  }

  notifyData() {
    if (this.state.notifying === true) {
      this.state.eventListener.remove();
      return Promise.try(() =>
        BleManager.stopNotification(
          '08:7C:BE:00:00:01',
          'fee9',
          'd44bc439-abfd-45a2-b575-925416129601'
        )
      )
      .then(() => Promise.delay(this.state.updatePeriod))
      .then(() =>
        BleManager.stopNotification(
          '08:7C:BE:00:00:01',
          'fee9',
          'd44bc439-abfd-45a2-b575-925416129602'
        )
      )
      .then(() => {
        this.setState({ notifying: false });
      })
      .catch((error) => {
        this.setState({ errorInfo: JSON.stringify(error, null, '  ') });
      });
    }

    return Promise.try(() =>
      BleManager.startNotification(
        '08:7C:BE:00:00:01',
        'fee9',
        'd44bc439-abfd-45a2-b575-925416129601'
      )
    )
    .then(() => Promise.delay(this.state.updatePeriod))
    .then(() =>
      BleManager.startNotification(
        '08:7C:BE:00:00:01',
        'fee9',
        'd44bc439-abfd-45a2-b575-925416129602'
      )
    )
    .then(() => {
      this.setState({ notifying: true });
      this.setState({ eventListener: NativeAppEventEmitter.addListener('BleManagerDidUpdateValueForCharacteristic', this.filteDataToState) });
    })
    .catch((error) => {
      this.setState({ errorInfo: JSON.stringify(error, null, '  ') });
    });
  }

  filteDataToState({ peripheral: peripheralID, characteristic, value }) {
    if (new Date().getTime() - this.state.lastACCDataUpdateTime >= this.state.updatePeriod && peripheralID === '08:7C:BE:00:00:01' && characteristic === 'd44bc439-abfd-45a2-b575-925416129601') {
      // push things like [ 252, 0, 146, 0, 239, 188 ]
      const datas = words(value, /\S{4}/g).map(parseRadix16);
      const accDataCache = ['加速度X·G¹', '加速度Y·G¹', '加速度Z·G¹'].map((name, index) => ({
        name, values: [...takeRight(this.state.accDataCache[index].values, this.state.dataCacheLimit), datas[index]]
      }));

      this.setState({ accCurrentData: value, accDataCache, lastACCDataUpdateTime: new Date().getTime() });
    } else if (new Date().getTime() - this.state.lastGYODataUpdateTime >= this.state.updatePeriod && peripheralID === '08:7C:BE:00:00:01' && characteristic === 'd44bc439-abfd-45a2-b575-925416129602') {
      const datas = words(value, /\S{4}/g).map(parseRadix16);
      const gyoDataCache = ['陀螺仪X·G¹', '陀螺仪Y·G¹', '陀螺仪Z·G¹'].map((name, index) => ({
        name, values: [...takeRight(this.state.gyoDataCache[index].values, this.state.dataCacheLimit), datas[index]]
      }));

      this.setState({ gyoCurrentData: value, gyoDataCache, lastGYODataUpdateTime: new Date().getTime() });
    }
  }

  render() {
    const XlineChartData = {
      datasets: [this.state.accDataCache[0], this.state.gyoDataCache[0]].map(({ name, values }, index) => ({
        yValues: values,
        label: name,
        config: {
          lineWidth: 3,
          drawCubic: true,
          drawCubicIntensity: 0.1,
          circleRadius: 0,
          drawHighlightIndicators: true,
          color: colorSwatches[index % colorSwatches.length],
        },
      })),
      // need to be limit + 1, or there will be a crash
      xValues: Array.from(new Array(this.state.dataCacheLimit + 2), (item, index) => index + 1).map(number => number.toString()),
    };
    const YlineChartData = {
      datasets: [this.state.accDataCache[1], this.state.gyoDataCache[1]].map(({ name, values }, index) => ({
        yValues: values,
        label: name,
        config: {
          lineWidth: 3,
          drawCubic: true,
          drawCubicIntensity: 0.1,
          circleRadius: 0,
          drawHighlightIndicators: true,
          color: colorSwatches[index % colorSwatches.length],
        },
      })),
      // need to be limit + 1, or there will be a crash
      xValues: Array.from(new Array(this.state.dataCacheLimit + 2), (item, index) => index + 1).map(number => number.toString()),
    };
    const ZlineChartData = {
      datasets: [this.state.accDataCache[2], this.state.gyoDataCache[2]].map(({ name, values }, index) => ({
        yValues: values,
        label: name,
        config: {
          lineWidth: 3,
          drawCubic: true,
          drawCubicIntensity: 0.1,
          circleRadius: 0,
          drawHighlightIndicators: true,
          color: colorSwatches[index % colorSwatches.length],
        },
      })),
      // need to be limit + 1, or there will be a crash
      xValues: Array.from(new Array(this.state.dataCacheLimit + 2), (item, index) => index + 1).map(number => number.toString()),
    };
    return (
      <Container>
        <Header style={{ width: windowWidth }}>
          <Button onPress={this.handleBack} transparent>
            <Icon name="ios-arrow-back" />
          </Button>
          <Title>大联大重力控制仪</Title>
          <Button onPress={() => this.setState({ showDetail: !this.state.showDetail })} transparent>
            <Icon name="md-document" />
          </Button>
          <Button onPress={() => this.setState({ openLineChart: !this.state.openLineChart })} transparent>
            <Icon name="md-podium" />
          </Button>
        </Header>
        <Content>
          <Text>{this.state.errorInfo || `ACC: ${this.state.accCurrentData}  GYO: ${this.state.gyoCurrentData}`}</Text>
          {
            this.state.openLineChart
              ?
                <View>
                  <LineChart
                    style={styles.chart}
                    data={XlineChartData}
                    description={{ text: '' }}

                    drawGridBackground={false}
                    borderColor={'teal'}
                    borderWidth={1}
                    drawBorders={true}

                    keepPositionOnRotation={false}
                  />
                  <LineChart
                    style={styles.chart}
                    data={YlineChartData}
                    description={{ text: '' }}

                    drawGridBackground={false}
                    borderColor={'teal'}
                    borderWidth={1}
                    drawBorders={true}

                    keepPositionOnRotation={false}
                  />
                  <LineChart
                    style={styles.chart}
                    data={ZlineChartData}
                    description={{ text: '' }}

                    drawGridBackground={false}
                    borderColor={'teal'}
                    borderWidth={1}
                    drawBorders={true}

                    keepPositionOnRotation={false}
                  />
                </View>
              : <View />
          }
          {
            this.state.showDetail
            ? <Text style={styles.summary}>{JSON.stringify(this.props.peripheralInfo, null, '  ')}</Text>
            : <View />
          }
        </Content>
        <Footer>
          <FooterTab>
            <Button onPress={this.notifyData} transparent>
              {this.state.notifying ? '... Notifying' : 'Start Notify'}
            </Button>
          </FooterTab>
        </Footer>
      </Container>
    );
  }
}
